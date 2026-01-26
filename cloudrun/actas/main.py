import os
import re
import json
import gc
import logging
import traceback

import fitz  # PyMuPDF
from PIL import Image
from pyzbar.pyzbar import decode
from google.cloud import storage, firestore


# -----------------------
# Logging
# -----------------------
logging.basicConfig(level=logging.INFO)
log = logging.getLogger("actas")

# -----------------------
# Config
# -----------------------
INBOX_PREFIX = "guias_actas/actas_servicio/inbox/"
OK_PREFIX    = "guias_actas/actas_servicio/ok/"
ERR_PREFIX   = "guias_actas/actas_servicio/error/"

# Colección real (según tu captura)
FIRESTORE_COLLECTION = os.getenv("ACTAS_COLLECTION", "liquidacion_instalaciones")

db = firestore.Client()
gcs = storage.Client()


# -----------------------
# Helpers
# -----------------------
def sanitize(name: str) -> str:
    # limpia caracteres inválidos para nombres "bonitos"
    name = re.sub(r'[\/\\:\*\?"<>\|]', " ", name or "")
    name = re.sub(r"\s+", " ", name).strip()
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name[:140] if name else "archivo.pdf"


def date_from_object_name(obj_name: str) -> str:
    # inbox/YYYY-MM-DD/archivo.pdf
    rest = obj_name[len(INBOX_PREFIX):]
    parts = rest.split("/", 1)
    if parts and re.match(r"^\d{4}-\d{2}-\d{2}$", parts[0]):
        return parts[0]
    return "sin_fecha"


def normalize_acta(raw: str):
    # raw: "0050063347" -> "005-0063347"
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) < 7:
        return None
    return f"{digits[:3]}-{digits[3:]}"


def candidate_names(object_name: str):
    """
    A veces el nombre llega con '?' pero el objeto real tiene '꞉' (U+A789) u otros cambios.
    Probamos varias variantes.
    """
    cands = [object_name]

    # ? <-> ꞉ (modifier letter colon)
    cands.append(object_name.replace("?", "꞉"))
    cands.append(object_name.replace("꞉", "?"))

    # por si vino con espacios raros
    cands.append(object_name.replace("%3F", "?"))
    cands.append(object_name.replace("%3A", ":"))

    # únicos
    out = []
    seen = set()
    for c in cands:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


def get_blob_safe(bucket, object_name: str, generation: int | None):
    """
    Devuelve el blob correcto o None.
    - Usa generation si viene en el evento.
    - Si no encuentra, prueba variantes del nombre.
    """
    for name_try in candidate_names(object_name):
        try:
            blob = bucket.get_blob(name_try, generation=generation) if generation else bucket.get_blob(name_try)
            if blob is not None:
                if name_try != object_name:
                    log.info("BLOB_NAME_VARIANT_USED orig=%s used=%s", object_name, name_try)
                return blob, name_try
        except Exception as e:
            log.warning("get_blob failed name=%s gen=%s err=%s", name_try, generation, str(e))
    return None, None


def read_barcode_top_right(pdf_bytes: bytes):
    doc = None
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc.load_page(0)

        # OJO: zoom alto = más RAM. Si te vuelve a consumir mucho, baja a 2.8 o 2.5
        zoom = float(os.getenv("PDF_ZOOM", "3.2"))
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)

        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
        w, h = img.size

        # Recorte arriba-derecha (más generoso)
        crop = img.crop((int(w * 0.45), 0, w, int(h * 0.40))).convert("L")

        codes = decode(crop)
        if not codes:
            return None

        return codes[0].data.decode("utf-8", errors="ignore")

    finally:
        try:
            if doc is not None:
                doc.close()
        except Exception:
            pass
        # liberar memoria
        gc.collect()


def unique_dest(bucket, dest_dir: str, filename: str) -> str:
    base, ext = os.path.splitext(filename)
    ext = ext or ".pdf"

    for i in range(0, 50):
        cand = f"{base}{ext}" if i == 0 else f"{base} ({i+1}){ext}"
        full = f"{dest_dir}{cand}"
        if bucket.blob(full).exists():
            continue
        return full

    # fallback
    return f"{dest_dir}{base} ({int(os.times().elapsed)}){ext}"


def move_object(bucket, src_name: str, dst_name: str, generation: int | None):
    """
    Mueve con copy+delete.
    Si el objeto ya no existe (eventos duplicados), no revienta.
    """
    # copiar
    src_blob = bucket.get_blob(src_name, generation=generation) if generation else bucket.get_blob(src_name)
    if src_blob is None:
        return False, "SRC_NOT_FOUND"

    bucket.copy_blob(src_blob, bucket, dst_name)

    # borrar (usando precondición por generación si la tenemos)
    try:
        if generation:
            src_blob.delete(if_generation_match=generation)
        else:
            src_blob.delete()
    except Exception as e:
        # si falló el delete por duplicado, no es fatal
        log.warning("DELETE_FAILED src=%s gen=%s err=%s", src_name, generation, str(e))

    return True, "MOVED"


# -----------------------
# Core
# -----------------------
def handle(bucket_name: str, object_name: str, generation: int | None):
    if not object_name.startswith(INBOX_PREFIX):
        return {"status": "skip_not_inbox"}

    if not object_name.lower().endswith(".pdf"):
        return {"status": "skip_not_pdf"}

    date_folder = date_from_object_name(object_name)
    bucket = gcs.bucket(bucket_name)

    # 1) Obtener blob seguro (por generation + variantes)
    blob, real_name = get_blob_safe(bucket, object_name, generation)
    if blob is None:
        # evento duplicado: ya lo moviste o borraste
        return {
            "status": "skip_missing_blob",
            "name": object_name,
            "generation": generation,
        }

    # 2) Descargar bytes
    pdf_bytes = blob.download_as_bytes()
    log.info("DOWNLOADED bytes=%s date_folder=%s name=%s gen=%s",
             len(pdf_bytes), date_folder, real_name, generation)

    # 3) Leer código de barras
    raw = read_barcode_top_right(pdf_bytes)
    log.info("BARCODE_RAW=%s", raw)

    acta = normalize_acta(raw)
    log.info("ACTA_NORMALIZED=%s", acta)

    if not acta:
        dst = f"{ERR_PREFIX}{date_folder}/{sanitize(os.path.basename(real_name))}"
        ok, why = move_object(bucket, real_name, dst, generation)
        return {"status": "error", "reason": "NO_BARCODE", "moved": ok, "why": why, "moved_to": dst}

    # 4) Buscar en Firestore (where correcto)
    snap = (
        db.collection(FIRESTORE_COLLECTION)
          .where("acta", "==", acta)
          .limit(2)
          .get()
    )

    if len(snap) == 0:
        dst = f"{ERR_PREFIX}{date_folder}/{sanitize(os.path.basename(real_name))}"
        ok, why = move_object(bucket, real_name, dst, generation)
        return {"status": "error", "reason": "NO_MATCH", "acta": acta, "moved": ok, "why": why, "moved_to": dst}

    if len(snap) > 1:
        dst = f"{ERR_PREFIX}{date_folder}/{sanitize(os.path.basename(real_name))}"
        ok, why = move_object(bucket, real_name, dst, generation)
        return {"status": "error", "reason": "DUPLICATE_MATCH", "acta": acta, "moved": ok, "why": why, "moved_to": dst}

    doc_ref = snap[0].reference
    data = snap[0].to_dict() or {}

    # Según tu captura: codigoCliente y cliente
    codigo = str(data.get("codigoCliente", "")).strip()
    cliente = str(data.get("cliente", "")).strip()

    if not codigo and data.get("codigoCliente") is None:
        # por si tu campo real fuera "codigoCliente" vs "codigoCliente_cliente" etc
        codigo = str(data.get("codigoCliente_cliente", "")).strip()

    final_filename = sanitize(f"{codigo} - {cliente}.pdf") if (codigo or cliente) else sanitize(f"ACTA_{acta}.pdf")
    dest_dir = f"{OK_PREFIX}{date_folder}/"
    dst = unique_dest(bucket, dest_dir, final_filename)

    ok, why = move_object(bucket, real_name, dst, generation)
    if not ok:
        return {"status": "error", "reason": "MOVE_FAILED", "acta": acta, "why": why, "dst": dst}

    # 5) Guardar estado en Firestore
    doc_ref.set({
        "acta_pdf_status": "OK",
        "acta_pdf_path": dst,
        "acta_pdf_nombre": os.path.basename(dst),
        "acta_pdf_actaDetectada": acta,
        "acta_pdf_raw_path": real_name,
        "acta_pdf_updatedAt": firestore.SERVER_TIMESTAMP,
        "acta_pdf_error": firestore.DELETE_FIELD,
    }, merge=True)

    return {"status": "ok", "acta": acta, "moved_to": dst}


# -----------------------
# WSGI entrypoint for Gunicorn
# -----------------------
def app(environ, start_response):
    try:
        length = int(environ.get("CONTENT_LENGTH") or "0")
        body = environ["wsgi.input"].read(length) if length else b"{}"
        event = json.loads(body.decode("utf-8") or "{}")

        log.info("EVENT_KEYS=%s", list(event.keys()))

        bucket = event.get("bucket")
        name = event.get("name")
        gen = event.get("generation")

        gen_int = None
        try:
            if gen is not None:
                gen_int = int(gen)
        except Exception:
            gen_int = None

        log.info("INBOX_EVENT bucket=%s name=%s generation=%s", bucket, name, gen_int)

        if not bucket or not name:
            start_response("200 OK", [("Content-Type", "application/json")])
            return [json.dumps({
                "status": "skip_missing_fields",
                "keys": list(event.keys())
            }).encode("utf-8")]

        result = handle(bucket, name, generation=gen_int)

        log.info("RESULT=%s", result)
        start_response("200 OK", [("Content-Type", "application/json")])
        return [json.dumps(result).encode("utf-8")]

    except Exception as e:
        log.error("APP_EXCEPTION: %s\n%s", str(e), traceback.format_exc())
        start_response("500 ERROR", [("Content-Type", "application/json")])
        return [json.dumps({"error": str(e)}).encode("utf-8")]
