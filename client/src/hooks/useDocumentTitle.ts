import { useEffect } from "react";
import { kebabToTitleCase } from "@/lib/utils";

const APP_NAME = kebabToTitleCase(__APP_NAME__);

/**
 * Sets document.title for the current page.
 * Pass a page name to get "<Page Name> - AppName",
 * or omit / pass undefined to reset to just the app name.
 */
export function useDocumentTitle(pageTitle?: string) {
  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} - ${APP_NAME}` : APP_NAME;
    return () => {
      document.title = APP_NAME;
    };
  }, [pageTitle]);
}
