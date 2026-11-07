import React from "react";

export default function Badge({
  status,
  children,
}: {
  status: string;
  children?: React.ReactNode;
}) {
  const label = children || status;
  const tone = ["进行", "通过", "已登记"].includes(status)
    ? "green"
    : ["数据", "统计"].includes(status)
      ? "purple"
      : status === "审核" || status === "待复核"
        ? "amber"
        : status === "驳回"
          ? "red"
          : status === "筹备" || status === "结项" || status === "草稿"
            ? "gray"
            : "";
  return <span className={`activity-badge ${tone}`}>{label}</span>;
}
