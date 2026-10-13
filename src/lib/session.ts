import { cookies } from "next/headers";
import { DEMO_SESSION_COOKIE, isValidDemoSessionId } from "./session-id";

export async function currentDemoSessionId(): Promise<string> {
  const value = (await cookies()).get(DEMO_SESSION_COOKIE)?.value;
  if (!isValidDemoSessionId(value)) {
    throw new Error("A valid demo session cookie is required");
  }
  return value;
}
