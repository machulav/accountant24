"use client";

import { ErrorPrimitive, MessagePrimitive } from "@assistant-ui/react";
import { AlertCircleIcon } from "lucide-react";
import type { FC } from "react";
import { Bubble, BubbleContent } from "@/components/shadcn/bubble";

export const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root asChild>
        <Bubble variant="destructive" className="mt-3">
          <BubbleContent className="flex items-center gap-2">
            <AlertCircleIcon className="size-4 shrink-0" />
            <ErrorPrimitive.Message className="line-clamp-2" />
          </BubbleContent>
        </Bubble>
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};
