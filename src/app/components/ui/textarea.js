export function Textarea(props) {
    return (
      <textarea
        className="border rounded-lg p-3 w-full min-h-[120px] focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-300 transition"
        {...props}
      />
    );
  }
  