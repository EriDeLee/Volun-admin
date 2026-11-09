import Icon from "./Icon.tsx";

export default function Brand({
  onNavigate,
}: { onNavigate?: (path: string) => void } = {}) {
  return (
    <a
      className="brand"
      href="/"
      aria-label="志愿服务项目管理平台"
      onClick={
        onNavigate
          ? (e) => {
              e.preventDefault();
              onNavigate("/");
            }
          : undefined
      }
    >
      <span className="logo">
        <Icon name="heart" />
      </span>
      <span>
        <strong>志愿服务</strong>
        <small>项目管理平台</small>
      </span>
    </a>
  );
}
