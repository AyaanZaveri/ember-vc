"use client";

import { Badge } from "@/components/ui/badge";
import type { CarouselApi } from "@/components/ui/carousel";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { cn } from "@/lib/utils";
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import type { ComponentProps } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type InlineCitationProps = ComponentProps<"span">;

export const InlineCitation = ({
  className,
  ...props
}: InlineCitationProps) => (
  <span
    className={cn("group inline items-center gap-1", className)}
    {...props}
  />
);

export type InlineCitationTextProps = ComponentProps<"span">;

export const InlineCitationText = ({
  className,
  ...props
}: InlineCitationTextProps) => (
  <span
    className={cn("transition-colors group-hover:bg-accent", className)}
    {...props}
  />
);

export type InlineCitationCardProps = ComponentProps<typeof HoverCard>;

export const InlineCitationCard = (props: InlineCitationCardProps) => (
  <HoverCard closeDelay={0} openDelay={0} {...props} />
);

export type InlineCitationCardTriggerProps = ComponentProps<typeof Badge> & {
  sources: string[];
  /** Human-readable citation index (e.g. "1" for "[1]"). Shown in the badge. */
  citationNumber?: number;
  /** Pre-resolved favicon URL */
  favicon?: string;
};

export const InlineCitationCardTrigger = ({
  sources,
  citationNumber,
  favicon,
  className,
  ...props
}: InlineCitationCardTriggerProps) => {
  const firstHostname = (() => {
    if (!sources[0]) return "unknown";
    try {
      return new URL(sources[0]).hostname.replace(/^www\./, "");
    } catch {
      return sources[0];
    }
  })();

  const faviconUrl = favicon || (() => {
    if (!sources[0]) return undefined;
    try {
      const hostname = new URL(sources[0]).hostname;
      return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`;
    } catch {
      return undefined;
    }
  })();

  return (
    <HoverCardTrigger asChild>
      <Badge
        className={cn(
          "cursor-pointer rounded-sm px-1.5 font-mono inline-flex items-center gap-1.5",
          className
        )}
        variant="secondary"
        {...props}
      >
        {faviconUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            aria-hidden
            className="size-3 shrink-0 rounded-xs object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
            src={faviconUrl}
          />
        )}
        {citationNumber != null && (
          <span className="font-semibold">{citationNumber}</span>
        )}
        {sources.length > 0 && (
          <>
            <span>{firstHostname}</span>
            {sources.length > 1 && (
              <span className="text-muted-foreground">+{sources.length - 1}</span>
            )}
          </>
        )}
      </Badge>
    </HoverCardTrigger>
  );
};


export type InlineCitationCardBodyProps = ComponentProps<"div">;

export const InlineCitationCardBody = ({
  className,
  ...props
}: InlineCitationCardBodyProps) => (
  <HoverCardContent className={cn("relative w-80 p-0", className)} {...props} />
);

const CarouselApiContext = createContext<CarouselApi | undefined>(undefined);

const useCarouselApi = () => {
  const context = useContext(CarouselApiContext);
  return context;
};

export type InlineCitationCarouselProps = ComponentProps<typeof Carousel>;

export const InlineCitationCarousel = ({
  className,
  children,
  opts,
  ...props
}: InlineCitationCarouselProps) => {
  const [api, setApi] = useState<CarouselApi>();

  return (
    <CarouselApiContext.Provider value={api}>
      <Carousel
        className={cn("w-full", className)}
        opts={{ duration: 12, ...opts }}
        setApi={setApi}
        {...props}
      >
        {children}
      </Carousel>
    </CarouselApiContext.Provider>
  );
};

export type InlineCitationCarouselContentProps = ComponentProps<"div">;

export const InlineCitationCarouselContent = (
  props: InlineCitationCarouselContentProps
) => <CarouselContent {...props} />;

export type InlineCitationCarouselItemProps = ComponentProps<"div">;

export const InlineCitationCarouselItem = ({
  className,
  ...props
}: InlineCitationCarouselItemProps) => (
  <CarouselItem
    className={cn("w-full space-y-2 p-4 pl-8", className)}
    {...props}
  />
);

export type InlineCitationCarouselHeaderProps = ComponentProps<"div">;

export const InlineCitationCarouselHeader = ({
  className,
  ...props
}: InlineCitationCarouselHeaderProps) => (
  <div
    className={cn(
      "flex items-center justify-between gap-2 rounded-t-md bg-secondary/30 p-2",
      className
    )}
    {...props}
  />
);

export type InlineCitationCarouselIndexProps = ComponentProps<"div">;

export const InlineCitationCarouselIndex = ({
  children,
  className,
  ...props
}: InlineCitationCarouselIndexProps) => {
  const api = useCarouselApi();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  const syncState = useCallback(() => {
    if (!api) {
      return;
    }
    setCount(api.scrollSnapList().length);
    setCurrent(api.selectedScrollSnap() + 1);
  }, [api]);

  useEffect(() => {
    if (!api) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    syncState();

    api.on("select", syncState);

    return () => {
      api.off("select", syncState);
    };
  }, [api, syncState]);

  return (
    <div
      className={cn(
        "flex flex-1 items-center justify-end py-1 text-muted-foreground text-xs",
        className
      )}
      {...props}
    >
      {children ?? `${current}/${count}`}
    </div>
  );
};

export type InlineCitationCarouselPrevProps = ComponentProps<"button">;

export const InlineCitationCarouselPrev = ({
  className,
  ...props
}: InlineCitationCarouselPrevProps) => {
  const api = useCarouselApi();

  const handleClick = useCallback(() => {
    if (api) {
      api.scrollPrev();
    }
  }, [api]);

  return (
    <button
      aria-label="Previous"
      className={cn("shrink-0", className)}
      onClick={handleClick}
      type="button"
      {...props}
    >
      <ArrowLeftIcon className="size-4 text-muted-foreground" />
    </button>
  );
};

export type InlineCitationCarouselNextProps = ComponentProps<"button">;

export const InlineCitationCarouselNext = ({
  className,
  ...props
}: InlineCitationCarouselNextProps) => {
  const api = useCarouselApi();

  const handleClick = useCallback(() => {
    if (api) {
      api.scrollNext();
    }
  }, [api]);

  return (
    <button
      aria-label="Next"
      className={cn("shrink-0", className)}
      onClick={handleClick}
      type="button"
      {...props}
    >
      <ArrowRightIcon className="size-4 text-muted-foreground" />
    </button>
  );
};

export type InlineCitationSourceProps = ComponentProps<"div"> & {
  title?: string;
  url?: string;
  description?: string;
  /** Favicon image URL — shown beside the source title. */
  favicon?: string;
};

export const InlineCitationSource = ({
  title,
  url,
  description,
  favicon,
  className,
  children,
  ...props
}: InlineCitationSourceProps) => (
  <div className={cn("space-y-2", className)} {...props}>
    <div className="flex items-center gap-2">
      {favicon && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          aria-hidden
          className="size-6 shrink-0 rounded-xs object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
          src={favicon}
        />
      )}
      <div className="min-w-0 flex-1 space-y-0">
        {title && url ? (
          <a
            className="block truncate font-medium text-sm leading-tight hover:underline"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            {title}
          </a>
        ) : title ? (
          <h4 className="truncate font-medium text-sm leading-tight">{title}</h4>
        ) : null}
        {url && (
          <p className="truncate text-muted-foreground text-xs font-mono">
            {(() => {
              try {
                return new URL(url).hostname.replace(/^www\./, "");
              } catch {
                return url;
              }
            })()}
          </p>
        )}
      </div>
    </div>
    {description && (
      <p className="line-clamp-3 text-muted-foreground text-sm leading-relaxed">
        {description}
      </p>
    )}
    {children}
  </div>
);

export type InlineCitationQuoteProps = ComponentProps<"blockquote">;

export const InlineCitationQuote = ({
  children,
  className,
  ...props
}: InlineCitationQuoteProps) => (
  <blockquote
    className={cn(
      "border-muted border-l-2 pl-3 text-muted-foreground text-sm italic",
      className
    )}
    {...props}
  >
    {children}
  </blockquote>
);
