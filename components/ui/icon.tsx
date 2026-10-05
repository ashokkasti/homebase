import { Icon as Iconify } from "@iconify/react/offline";
import { iconData, type IconName } from "./icon-data";
export type { IconName };
export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <Iconify
      icon={iconData[name]}
      width={size}
      height={size}
      className={className ? `icon ${className}` : "icon"}
      aria-hidden
    />
  );
}
