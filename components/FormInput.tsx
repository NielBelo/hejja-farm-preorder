type FormInputProps = {
  label: string;
  name: string;
  type?: "text" | "email" | "password" | "tel";
  placeholder?: string;
  defaultValue?: string;
  error?: string | null;
};

export default function FormInput({
  label,
  name,
  type = "text",
  placeholder,
  defaultValue,
  error,
}: FormInputProps) {
  return (
    <div>
      <label
        htmlFor={name}
        className="mb-2 block text-sm font-medium text-gray-700"
      >
        {label}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        className={`
          w-full
          rounded-xl
          border-2
          bg-white
          px-4
          py-2.5
          text-gray-700
          outline-none
          transition
          ${
            error
              ? "border-red-400"
              : "border-[rgba(7,109,143,0.2)]"
          }
        `}
      />

      {error && (
        <p className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}