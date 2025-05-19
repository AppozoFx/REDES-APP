// src/components/ui/card.js
import React from "react";

export function Card({ className = "", ...props }) {
  return (
    <div className={`rounded-xl border bg-white p-4 shadow ${className}`} {...props} />
  );
}

export function CardContent({ className = "", ...props }) {
  return (
    <div className={`p-4 ${className}`} {...props} />
  );
}
