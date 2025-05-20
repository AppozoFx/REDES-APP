// src/components/FormFields.js
export function InputField({ label, name, type = "text", value, onChange, required = false }) {
    return (
      <div>
        <label htmlFor={name} className="block mb-1 font-semibold">{label}</label>
        <input
          id={name}
          name={name}
          type={type}
          value={value}
          onChange={onChange}
          required={required}
          className="w-full border px-3 py-2 rounded-md shadow-sm focus:outline-none focus:ring focus:ring-[#30518c]/30"
        />
      </div>
    );
  }
  
  export function SelectField({ label, name, value, onChange, options }) {
    return (
      <div>
        <label htmlFor={name} className="block mb-1 font-semibold">{label}</label>
        <select
          id={name}
          name={name}
          value={value}
          onChange={onChange}
          className="w-full border px-3 py-2 rounded-md shadow-sm focus:outline-none"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    );
  }
  