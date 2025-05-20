// components/ui/input.jsx
import React from "react";
import clsx from "clsx";

export const Input = React.forwardRef(({ label, error, className, ...props }, ref) => {
  return (
    <div className="w-full mb-4">
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      <input
        ref={ref}
        {...props}
        className={clsx(
          "w-full px-3 py-2 border rounded-md shadow-sm text-sm",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent",
          error ? "border-red-500" : "border-gray-300",
          className
        )}
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
});

Input.displayName = "Input";
