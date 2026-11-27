/** O login fica lembrado no aparelho até a pessoa sair. 400 dias é o máximo que os navegadores aceitam num cookie; o uso renova. */
export const SESSION_DAYS = 400;
export const COOKIE = "marfim_session";
export const SESSION_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: SESSION_DAYS * 86400 } as const;
