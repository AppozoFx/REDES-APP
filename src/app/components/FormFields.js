// src/components/FormFields.js
import React from "react";

export function InputField({
  label,
  name,
  type = "text",
  value,
  onChange,
  required = false,
  error = "",
  className = "",
  ...props
}) {
  return (
    <div className="mb-4">
      {label && (
        <label htmlFor={name} className="block mb-1 font-semibold text-sm text-gray-700">
          {label}
        </label>
      )}
      <input
        id={name}
        name={name}
        type={type}
        value={value}
        onChange={onChange}
        required={required}
        className={`w-full border px-3 py-2 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-[#30518c] ${error ? "border-red-500" : "border-gray-300"} ${className}`}
        {...props}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export function SelectField({
  label,
  name,
  value,
  onChange,
  options = [],
  required = false,
  error = "",
  className = "",
  ...props
}) {
  return (
    <div className="mb-4">
      {label && (
        <label htmlFor={name} className="block mb-1 font-semibold text-sm text-gray-700">
          {label}
        </label>
      )}
      <select
        id={name}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        className={`w-full border px-3 py-2 rounded-md shadow-sm text-sm focus:outline-none focus:ring-2 focus:ring-[#30518c] ${error ? "border-red-500" : "border-gray-300"} ${className}`}
        {...props}
      >
        <option value="">-- Seleccionar --</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}
