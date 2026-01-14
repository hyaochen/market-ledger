'use server';

import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { createHash } from "crypto";
import { signSession } from "@/lib/session";
import { resolveRoleCode } from "@/lib/auth";

export async function login(formData: FormData) {
    const username = (formData.get("username") as string | null)?.trim();
    const password = formData.get("password") as string | null;

    if (!username || !password) {
        return { success: false, message: "請輸入帳號與密碼" };
    }

    const user = await prisma.user.findUnique({
        where: { username },
        include: { roles: { include: { role: true } } },
    });

    if (!user || !user.status) {
        return { success: false, message: "帳號不存在或已停用" };
    }

    const hashedPassword = createHash("sha256").update(password).digest("hex");
    if (user.password !== hashedPassword) {
        return { success: false, message: "密碼錯誤" };
    }

    const roleCodes = user.roles.map((item) => item.role.code);
    const roleCode = resolveRoleCode(roleCodes);

    const token = signSession({
        userId: user.id,
        issuedAt: Date.now(),
    });

    const cookieStore = await cookies();
    cookieStore.set("session", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });

    return { success: true, roleCode };
}

export async function logout() {
    const cookieStore = await cookies();
    cookieStore.set("session", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 0,
    });
    return { success: true };
}
