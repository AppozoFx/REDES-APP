// src/components/ui/card.js
import React from "react";

export function Card({ className = "", children, ...props }) {
  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardContent({ className = "", children, ...props }) {
  return (
    <div className={`p-4 ${className}`} {...props}>
      {children}
    </div>
  );
}
