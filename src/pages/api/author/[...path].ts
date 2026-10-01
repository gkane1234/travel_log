import type { APIRoute } from "astro";
import { handleAuthorRequest } from "../../../lib/author-http";

export const prerender = false;

const handle: APIRoute = ({ request }) => handleAuthorRequest(request);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
