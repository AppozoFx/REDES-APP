FROM python:3.11-slim

# Evita .pyc y mejora logs
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

# Dependencias del sistema:
# - libzbar0: lectura barcode
# - libglib2.0-0 / libsm6 / libxrender1 / libxext6: evita fallos raros con Pillow en algunos casos
# - tini: init para manejo correcto de procesos (gunicorn) en contenedor
RUN apt-get update && apt-get install -y --no-install-recommends \
    libzbar0 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

# Tini como init
ENTRYPOINT ["/usr/bin/tini", "--"]

# Gunicorn recomendado para Cloud Run (1 worker porque tu concurrency=1)
CMD ["gunicorn", "-b", ":8080", "--workers=1", "--threads=1", "--timeout=300", "--access-logfile=-", "--error-logfile=-", "main:app"]
