// A secret counts as set only if it is not empty and not a "<placeholder>" from .dev.vars.example.
export const isSet = (v) => Boolean(v) && !String(v).startsWith('<');

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
