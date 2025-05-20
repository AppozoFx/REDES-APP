// components/ui/button.tsx

import React from "react";

export const Button = ({ children, ...props }) => (
  <button
    className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
    {...props}
  >
    {children}
  </button>
);
