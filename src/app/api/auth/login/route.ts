import { NextResponse } from "next/server";
import { SESSION_COOKIE, createSession, loginUser } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";

    const user = await loginUser({ email, password });
    if (!user) {
      return NextResponse.json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } }, { status: 401 });
    }

    const token = await createSession(user.id);
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error && /SSL|TLS|MongoServerSelection|ECONNREFUSED/i.test(error.message)
      ? "Database connection failed. Check the MongoDB Atlas URI, database user password, and Network Access IP list."
      : error instanceof Error ? error.message : "Could not log in.";
    return NextResponse.json(
      { error: { code: "LOGIN_FAILED", message } },
      { status: 400 },
    );
  }
}
