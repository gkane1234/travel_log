import { defineMiddleware } from "astro:middleware";
import { isRequestAuthed } from "./lib/auth";

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;
  const isAuthorPage =
    path === "/author" || (path.startsWith("/author/") && path !== "/author/login");
  if (isAuthorPage && !isRequestAuthed(context.request)) {
    return context.redirect("/author/login");
  }
  return next();
});
