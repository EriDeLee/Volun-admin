import { useRef, type ComponentProps } from "react";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const isField = (target: EventTarget | null): target is Field =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLSelectElement ||
  target instanceof HTMLTextAreaElement;

export function passwordValid(value: string) {
  const bytes = new TextEncoder().encode(value).length;
  return bytes >= 12 && bytes <= 72;
}

export function phoneValid(value: string) {
  const normalized = value.trim().replace(/^\+86/, "").replace(/[ -]/g, "");
  return /^1[3-9][0-9]{9}$/.test(normalized);
}

export function fieldValid(field: Field) {
  if (!field.willValidate) return true;
  if (!field.validity.valid) return false;
  if (!field.value) return !field.required;
  if (
    field.required &&
    field.dataset.validate !== "password" &&
    !field.value.trim()
  )
    return false;
  if (field.dataset.validate === "password" && !passwordValid(field.value))
    return false;
  if (field.dataset.validate === "phone" && !phoneValid(field.value))
    return false;
  if (
    field.dataset.validate === "username" &&
    /[\s\p{Cc}/\\]/u.test(field.value)
  )
    return false;
  if (
    field.dataset.maxLength &&
    [...field.value].length > Number(field.dataset.maxLength)
  )
    return false;
  if (field.dataset.after && field.value <= field.dataset.after) return false;
  if (field.dataset.matches) {
    const other = field.form?.querySelector<HTMLInputElement>(
      `#${field.dataset.matches}`,
    );
    if (!other || field.value !== other.value) return false;
  }
  return true;
}

export default function ValidatedForm({
  onSubmit,
  onBlurCapture,
  onChangeCapture,
  validateField,
  ...props
}: ComponentProps<"form"> & { validateField?: (field: Field) => boolean }) {
  const touched = useRef(new WeakSet<Field>());
  const check = (field: Field) => {
    const okay = fieldValid(field) && (!validateField || validateField(field));
    if (okay) field.removeAttribute("aria-invalid");
    else field.setAttribute("aria-invalid", "true");
    return okay;
  };
  return (
    <form
      {...props}
      noValidate
      onBlurCapture={(event) => {
        onBlurCapture?.(event);
        if (isField(event.target)) {
          touched.current.add(event.target);
          check(event.target);
        }
      }}
      onChangeCapture={(event) => {
        onChangeCapture?.(event);
        for (const field of Array.from(event.currentTarget.elements)) {
          if (
            isField(field) &&
            (touched.current.has(field) ||
              field.getAttribute("aria-invalid") === "true")
          )
            check(field);
        }
      }}
      onSubmit={(event) => {
        let first: Field | undefined;
        for (const field of Array.from(event.currentTarget.elements)) {
          if (!isField(field)) continue;
          touched.current.add(field);
          if (!check(field)) first ??= field;
        }
        if (first) {
          event.preventDefault();
          first.focus();
        } else onSubmit?.(event);
      }}
    />
  );
}
