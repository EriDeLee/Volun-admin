import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const isField = (target: EventTarget | null): target is Field =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLSelectElement ||
  target instanceof HTMLTextAreaElement;

const passwordRule =
  "密码长度需为 12–72 字节；英文字母、数字通常占 1 字节，常用汉字通常占 3 字节。";
export function passwordValid(value: string) {
  const bytes = new TextEncoder().encode(value).length;
  return bytes >= 12 && bytes <= 72;
}

export function phoneValid(value: string) {
  const normalized = value.trim().replace(/^\+86/, "").replace(/[ -]/g, "");
  return /^1[3-9][0-9]{9}$/.test(normalized);
}

export function fieldError(field: Field): string {
  if (!field.willValidate) return "";
  const validity = field.validity;
  if (validity.badInput) return "请输入有效数字。";
  if (validity.valueMissing) return "请填写此项。";
  if (!field.value) return "";
  if (
    field.required &&
    field.dataset.validate !== "password" &&
    !["current-password", "new-password"].includes(field.autocomplete) &&
    !field.value.trim()
  )
    return "请填写此项，不能仅含空白。";
  if (field.dataset.validate === "password" && !passwordValid(field.value)) {
    const bytes = new TextEncoder().encode(field.value).length;
    return `${bytes < 12 ? "密码太短" : "密码太长"}。${passwordRule}`;
  }
  if (field.dataset.validate === "phone" && !phoneValid(field.value))
    return "请输入有效的 11 位手机号。";
  if (
    field.dataset.validate === "username" &&
    /[\s\p{Cc}/\\]/u.test(field.value)
  )
    return "账号不能含空白、控制字符或斜杠。";
  if (
    field.dataset.maxLength &&
    [...field.value].length > Number(field.dataset.maxLength)
  )
    return `最多填写 ${field.dataset.maxLength} 个字符。`;
  if (field.dataset.after && field.value <= field.dataset.after)
    return "结束时间须晚于开始时间。";
  if (field.dataset.matches) {
    const other = field.form?.querySelector<HTMLInputElement>(
      `#${field.dataset.matches}`,
    );
    if (!other || field.value !== other.value) return "两次密码不一致。";
  }
  if (validity.rangeUnderflow && field instanceof HTMLInputElement)
    return `请输入不小于 ${field.min} 的值。`;
  if (validity.rangeOverflow && field instanceof HTMLInputElement)
    return `请输入不大于 ${field.max} 的值。`;
  if (
    validity.stepMismatch &&
    field instanceof HTMLInputElement &&
    field.type === "number"
  )
    return field.step === "1" || !field.step
      ? "请输入整数。"
      : `请输入步长为 ${field.step} 的数值。`;
  return validity.valid
    ? ""
    : field.validationMessage || "请检查此项填写内容。";
}

export function fieldValid(field: Field) {
  return !fieldError(field);
}

function describeError(field: Field, id: string, present: boolean) {
  const ids = (field.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter((value) => value && value !== id);
  if (present) ids.push(id);
  if (ids.length) field.setAttribute("aria-describedby", ids.join(" "));
  else field.removeAttribute("aria-describedby");
}

export default function ValidatedForm({
  onSubmit,
  onBlurCapture,
  onChangeCapture,
  onReset,
  validateField,
  children,
  ...props
}: ComponentProps<"form"> & {
  validateField?: (field: Field) => boolean | string;
}) {
  const touched = useRef(new WeakSet<Field>());
  const errorID = useId();
  const sequence = useRef(0);
  // The form validates native controls supplied by arbitrary child components.
  // Own only these adjacent error nodes; leave the controls and labels to React.
  const errors = useRef(new Map<Field, HTMLSpanElement>());
  const [announcement, setAnnouncement] = useState("");
  const clear = (field: Field, message: HTMLSpanElement) => {
    describeError(field, message.id, false);
    message.remove();
    errors.current.delete(field);
  };
  const check = (field: Field) => {
    let error = fieldError(field);
    if (!error && field.willValidate && validateField) {
      const result = validateField(field);
      error =
        typeof result === "string"
          ? result
          : result
            ? ""
            : "请检查此项填写内容。";
    }
    let message = errors.current.get(field);
    if (!error) {
      field.removeAttribute("aria-invalid");
      if (message) clear(field, message);
    } else {
      if (!message) {
        message = document.createElement("span");
        message.id = `${errorID}-${++sequence.current}`;
        message.className = "field-error";
        // Keep error text out of a wrapping label's accessible name. An explicit
        // aria-describedby reference still exposes it as the field description.
        if (field.closest("label")) message.setAttribute("aria-hidden", "true");
        const anchor =
          field.closest(".password-field, .account-password") || field;
        anchor.after(message);
        errors.current.set(field, message);
      }
      message.textContent = error;
      field.setAttribute("aria-invalid", "true");
      describeError(field, message.id, true);
    }
    return error;
  };
  useLayoutEffect(() => {
    // Controlled inputs may change constraints/descriptions during the same event.
    for (const [field, message] of errors.current) {
      if (!field.isConnected) clear(field, message);
      else check(field);
    }
  });
  useEffect(() => {
    const messages = errors.current;
    return () => {
      for (const [field, message] of messages) {
        describeError(field, message.id, false);
        message.remove();
      }
      messages.clear();
    };
  }, []);
  return (
    <form
      {...props}
      noValidate
      onBlurCapture={(event) => {
        onBlurCapture?.(event);
        if (isField(event.target)) {
          touched.current.add(event.target);
          setAnnouncement(check(event.target));
        }
      }}
      onChangeCapture={(event) => {
        onChangeCapture?.(event);
        setAnnouncement("");
        for (const field of Array.from(event.currentTarget.elements)) {
          if (
            isField(field) &&
            (touched.current.has(field) ||
              field.getAttribute("aria-invalid") === "true")
          )
            check(field);
        }
      }}
      onReset={(event) => {
        onReset?.(event);
        if (event.defaultPrevented) return;
        for (const [field, message] of errors.current) {
          field.removeAttribute("aria-invalid");
          clear(field, message);
        }
        touched.current = new WeakSet();
        setAnnouncement("");
      }}
      onSubmit={(event) => {
        let first: Field | undefined;
        for (const field of Array.from(event.currentTarget.elements)) {
          if (!isField(field)) continue;
          touched.current.add(field);
          if (check(field)) first ??= field;
        }
        if (first) {
          event.preventDefault();
          first.focus();
        } else onSubmit?.(event);
      }}
    >
      {children}
      <span className="validation-announcement" aria-live="polite">
        {announcement}
      </span>
    </form>
  );
}
