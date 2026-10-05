"use client";
import type { Resource } from "@/lib/schemas";
import { Button } from "../ui/button";
import { Icon } from "../ui/icon";

export function ApplyBanner({
  resource,
  onApply,
}: {
  resource: Resource;
  onApply: () => void;
}) {
  const database = resource.kind === "database";
  return (
    <div className="banner banner-amber apply-banner" role="status">
      <Icon name="info" size={18} />
      <span>
        <strong>Saved.</strong> Changes take effect after the next{" "}
        {database ? "restart" : "deployment"}.
      </span>
      <Button size="sm" onClick={onApply}>
        <Icon name={database ? "restart" : "deploy"} size={15} />
        {database ? "Restart now" : "Redeploy now"}
      </Button>
    </div>
  );
}
