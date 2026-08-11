require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const app = express();
app.set("etag", false);
const prisma = new PrismaClient();

// Sends an email through Brevo's HTTP API (port 443) instead of raw SMTP
// (ports 587/465/25), because Render's free tier blocks outbound SMTP ports.
async function sendBrevoEmail({ toEmail, toName, subject, text }) {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "api-key": process.env.BREVO_API_KEY
        },
        body: JSON.stringify({
            sender: {
                name: "IKGPTU Smart Campus",
                email: process.env.BREVO_SENDER_EMAIL
            },
            to: [
                { email: toEmail, name: toName }
            ],
            subject,
            textContent: text
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(
            `Brevo API error (status ${response.status}): ${errorBody}`
        );
    }

    return response.json();
}

function generateOTP() {
    return crypto.randomInt(100000, 1000000).toString();
}

// Stay safely under Brevo's free-tier 300/day limit — leaving a buffer
// for the OTP verification-resend flow, plus any manual testing.
const DAILY_OTP_LIMIT = 280;

// Gives today's date as "YYYY-MM-DD" in Indian time, so the daily
// counter resets at midnight IST (matches when actual campus usage
// resets), not at midnight UTC.
function getTodayKeyIST() {
    return new Date().toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata"
    });
}
app.use(cors());
app.use(express.json());

// Student logs in with the admin password ONCE here, and gets back a
// signed token that expires after 6 hours — instead of the raw password
// being sent (and compared) on every single request from here on.
app.post("/admin/login", (req, res) => {

    const { password } = req.body;

    if (!password || password !== process.env.ADMIN_KEY) {
        return res.status(401).json({ message: "Incorrect admin password." });
    }

    // If JWT_SECRET isn't set, jwt.sign() throws — without this check,
    // that crash gets misreported to the user as "wrong password",
    // which is confusing. Fail loudly and clearly instead.
    if (!process.env.JWT_SECRET) {
        console.log("Admin login failed: JWT_SECRET is not set in environment variables.");
        return res.status(500).json({
            message: "Server is misconfigured (missing JWT_SECRET). This is not a wrong-password issue."
        });
    }

    const token = jwt.sign(
        { role: "admin" },
        process.env.JWT_SECRET,
        { expiresIn: "6h" }
    );

    res.json({ token });

});

// Blocks direct access to student data unless a valid, non-expired
// admin token is sent. admin.html gets this token once from
// /admin/login, then sends it on every request via the Authorization
// header — the server never has to see the actual password again.
function requireAdminKey(req, res, next) {

    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }

    try {
        jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch (error) {
        return res.status(401).json({ message: "Session expired. Please log in again." });
    }

}

app.get("/", (req, res) => {
    res.send("Backend is running 🚀");
});
app.post("/send-otp", async (req, res) => {
    try {
        const { name, phone, email, category, course, batch } = req.body;

        // 1. Check that every registration field was provided
        if (!name || !phone || !email || !category || !course || !batch) {
            return res.status(400).json({
                message: "All fields are required."
            });
        }

        // 1b. Phone must be exactly 10 digits, starting with 6-9 (valid
        // Indian mobile format). This is the check that actually matters —
        // the frontend one can always be bypassed by calling the API directly.
        const phonePattern = /^[6-9]\d{9}$/;
        if (!phonePattern.test(phone)) {
            return res.status(400).json({
                message: "Please enter a valid 10-digit phone number."
            });
        }

        // 2. Look up whether this phone or email belongs to an existing,
        // already-verified student. We check both together (not phone
        // first, then email) so we can tell "this is the same person
        // registering again" apart from "this is a genuine conflict".
        const existingPhone = await prisma.student.findUnique({
            where: { phone: phone }
        });

        const existingEmail = await prisma.student.findUnique({
            where: { email: email }
        });

        // Same phone AND same email already registered together =
        // this is a returning student, not a conflict.
        if (existingPhone && existingEmail && existingPhone.id === existingEmail.id) {

            if (existingPhone.emailVerified) {
                // Fully verified — send them straight to the map.
                return res.status(200).json({
                    alreadyRegistered: true,
                    message: "You're already registered."
                });
            }

            // They registered earlier during a daily-limit fallback and
            // never got a real OTP. Let the code below try to send them
            // one now (subject to today's quota) instead of dead-ending
            // them here — this is how they eventually get fully verified.
        } else if (existingPhone) {

            // Phone matches one student, but the email doesn't match that
            // same student — likely someone else's number, or a typo.
            return res.status(400).json({
                message: "This phone number is already registered with a different email."
            });

        } else if (existingEmail) {

            // Email matches one student, but the phone doesn't match that
            // same student.
            return res.status(400).json({
                message: "This email is already registered with a different phone number."
            });
        }

        // 4. Remove any previous unfinished registration
        await prisma.pendingRegistration.deleteMany({
            where: {
                OR: [
                    { email: email },
                    { phone: phone }
                ]
            }
        });

        // 5. Check today's OTP send count. If we're at (or past) the
        // daily limit, don't even try sending an email — register the
        // student directly as unverified instead of dead-ending them.
        const todayKey = getTodayKeyIST();
        const todayUsage = await prisma.otpUsage.findUnique({
            where: { date: todayKey }
        });
        const sentSoFarToday = todayUsage ? todayUsage.count : 0;

        if (sentSoFarToday >= DAILY_OTP_LIMIT) {

            // Already exists as an unverified student (this is a
            // re-verification attempt) — nothing to create, just let
            // them know they already have access and to try again later.
            if (existingPhone && existingEmail && existingPhone.id === existingEmail.id) {
                return res.status(200).json({
                    skippedVerification: true,
                    message:
                        "Today's email verification limit has been reached again. You already have map access — please try verifying your email again later."
                });
            }

            const student = await prisma.student.create({
                data: {
                    name,
                    phone,
                    email,
                    category,
                    course,
                    batch,
                    emailVerified: false
                }
            });

            console.log(
                "Daily OTP limit reached — registered without verification:",
                student.email
            );

            return res.status(200).json({
                skippedVerification: true,
                message:
                    "Today's email verification limit has been reached, so you're registered without email verification for now. You can verify your email later."
            });
        }

        // 6. Generate a secure 6-digit OTP
        const otp = generateOTP();

        // 7. Hash the OTP before storing it
        const otpHash = crypto
            .createHash("sha256")
            .update(otp)
            .digest("hex");

        // 8. OTP expires after 10 minutes
        const otpExpiry = new Date(
            Date.now() + 10 * 60 * 1000
        );

        // 9. Store the pending registration
        await prisma.pendingRegistration.create({
            data: {
                name,
                phone,
                email,
                category,
                course,
                batch,
                otpHash,
                otpExpiry
            }
        });

        // 10. Send the OTP through Brevo's HTTP API
        await sendBrevoEmail({
            toEmail: email,
            toName: name,
            subject: "IKGPTU Smart Campus - Email Verification",
            text: `Hello ${name},

Your IKGPTU Smart Campus verification OTP is:

${otp}

This OTP is valid for 10 minutes.

If you did not request this verification, you can ignore this email.

Regards,
IKGPTU Smart Campus`
        });

        // 11. Count this OTP against today's total, now that it actually
        // sent successfully
        await prisma.otpUsage.upsert({
            where: { date: todayKey },
            update: { count: { increment: 1 } },
            create: { date: todayKey, count: 1 }
        });

        console.log("OTP sent to:", email);

        res.json({
            message: "OTP sent successfully."
        });

    } catch (error) {
        console.log("OTP error:", error);

        res.status(500).json({
            message: "Unable to send OTP."
        });
    }
});
app.post("/verify-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;

        // 1. Check required fields
        if (!email || !otp) {
            return res.status(400).json({
                message: "Email and OTP are required."
            });
        }

        // 2. Find the pending registration
        const pending = await prisma.pendingRegistration.findUnique({
            where: {
                email: email
            }
        });

        if (!pending) {
            return res.status(400).json({
                message: "No pending registration found."
            });
        }

        // 3. Check whether the OTP has expired
        if (new Date() > pending.otpExpiry) {
            await prisma.pendingRegistration.delete({
                where: {
                    id: pending.id
                }
            });

            return res.status(400).json({
                message: "OTP has expired. Please request a new OTP."
            });
        }

        // 4. Hash the OTP entered by the student
        const enteredOtpHash = crypto
            .createHash("sha256")
            .update(otp)
            .digest("hex");

        // 5. Compare the hashes
        if (enteredOtpHash !== pending.otpHash) {
            return res.status(400).json({
                message: "Invalid OTP."
            });
        }

        // 6. Create the verified student — unless one already exists
        // with this email (they registered earlier during a daily-limit
        // fallback and are now completing real verification), in which
        // case just mark that existing record as verified instead of
        // trying to create a duplicate (which would fail on the unique
        // email/phone constraint).
        const existingUnverified = await prisma.student.findUnique({
            where: { email: pending.email }
        });

        const student = existingUnverified
            ? await prisma.student.update({
                where: { id: existingUnverified.id },
                data: { emailVerified: true }
            })
            : await prisma.student.create({
                data: {
                    name: pending.name,
                    phone: pending.phone,
                    email: pending.email,
                    category: pending.category,
                    course: pending.course,
                    batch: pending.batch
                }
            });

        // 7. Delete the temporary registration
        await prisma.pendingRegistration.delete({
            where: {
                id: pending.id
            }
        });

        console.log("Student verified:", student.email);

        // 8. Tell the frontend registration succeeded
        res.status(201).json({
            message: "Email verified and registration completed."
        });

    } catch (error) {
        console.log("OTP verification error:", error);

        res.status(500).json({
            message: "Unable to verify OTP."
        });
    }
});
app.post("/register", async (req, res) => {
    try {
        const { name, phone, category, course, batch } = req.body;

        const existingStudent = await prisma.student.findUnique({
            where: {
                phone: phone
            }
        });

        if (existingStudent) {
            return res.status(400).json({
                message: "Phone number already registered."
            });
        }

        const student = await prisma.student.create({
            data: {
                name,
                phone,
                category,
                course,
                batch
            }
        });

        res.status(201).json(student);

    } catch (error) {
    console.log(error);
    // If two requests race (e.g. a double-click) and both pass the
    // duplicate check before either finishes, Prisma throws a unique
    // constraint error here. Treat it the same as "already registered"
    // instead of a raw server error.
    if (error.code === "P2002") {
        return res.status(400).json({
            message: "Phone number already registered."
        });
    }
    res.status(500).json({
        message: "Server Error"
    });
}
});
app.get("/students", requireAdminKey, async (req, res) => {

    // Never let the browser cache this — old cached responses could
    // otherwise be reused even after a wrong password is entered.
    res.set("Cache-Control", "no-store");

    try {

        const { category, course, batch } = req.query;

        let where = {};

        if (category) {
            where.category = category;
        }

        if (course) {
            where.course = course;
        }

        if (batch) {
            where.batch = batch;
        }

        const students = await prisma.student.findMany({
            where,
            orderBy: {
                id: "desc"
            }
        });

        res.json(students);

    } catch (error) {

        console.log(error);

        res.status(500).json({
            message: "Server Error"
        });

    }

});
const PORT = 3000;



app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});