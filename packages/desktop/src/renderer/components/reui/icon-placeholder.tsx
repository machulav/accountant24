// Local adapter, the one file in components/reui/ that is ours: ReUI's
// registry code references a site-internal <IconPlaceholder> that abstracts
// over icon libraries (lucide/tabler/hugeicons/phosphor/remixicon). This app
// uses lucide, so the shim renders the `lucide`-named icon and ignores the
// other libraries' names. Icons are imported explicitly so the bundle never
// swallows the whole lucide barrel.

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowLeftToLineIcon,
  ArrowRightIcon,
  ArrowRightToLineIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  CirclePlusIcon,
  GripHorizontalIcon,
  GripVerticalIcon,
  type LucideIcon,
  PinOffIcon,
  Settings2Icon,
} from "lucide-react";
import type { ComponentProps, FC } from "react";

const ICONS = {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowLeftToLineIcon,
  ArrowRightIcon,
  ArrowRightToLineIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  CirclePlusIcon,
  GripHorizontalIcon,
  GripVerticalIcon,
  PinOffIcon,
  Settings2Icon,
} satisfies Record<string, LucideIcon>;

export const IconPlaceholder: FC<
  ComponentProps<"svg"> & {
    lucide: keyof typeof ICONS;
    tabler?: string;
    hugeicons?: string;
    phosphor?: string;
    remixicon?: string;
  }
> = ({ lucide, tabler: _tabler, hugeicons: _hugeicons, phosphor: _phosphor, remixicon: _remixicon, ...props }) => {
  const Icon = ICONS[lucide];
  return <Icon {...props} />;
};
