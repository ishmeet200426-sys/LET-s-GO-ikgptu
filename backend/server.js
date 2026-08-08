require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { PrismaClient } = require("@prisma/client");
const app = express();
app.set("etag", false);
const prisma = new PrismaClient();
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
    }
});
function generateOTP() {
    return crypto.randomInt(100000, 1000000).toString();
}
app.use(cors());
app.use(express.json());

// Blocks direct access to student data unless the correct key is sent.
// admin.html sends this automatically once you enter the password there.
function requireAdminKey(req, res, next) {
    const key = req.headers["x-admin-key"];
    console.log("DEBUG -> received key:", JSON.stringify(key), "| expected:", JSON.stringify(process.env.ADMIN_KEY));
    if (key !== process.env.ADMIN_KEY) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    next();
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

        // 2. Check whether this phone is already registered
        const existingPhone = await prisma.student.findUnique({
            where: {
                phone: phone
            }
        });

        if (existingPhone) {
            return res.status(400).json({
                message: "Phone number already registered."
            });
        }

        // 3. Check whether this email is already registered
        const existingEmail = await prisma.student.findUnique({
            where: {
                email: email
            }
        });

        if (existingEmail) {
            return res.status(400).json({
                message: "Email already registered."
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

        // 5. Generate a secure 6-digit OTP
        const otp = generateOTP();

        // 6. Hash the OTP before storing it
        const otpHash = crypto
            .createHash("sha256")
            .update(otp)
            .digest("hex");

        // 7. OTP expires after 10 minutes
        const otpExpiry = new Date(
            Date.now() + 10 * 60 * 1000
        );

        // 8. Store the pending registration
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

        // 9. Send the OTP through Brevo
        await transporter.sendMail({
            from: {
                name: "IKGPTU Smart Campus",
                address: process.env.SMTP_USER
            },
            to: email,
            subject: "IKGPTU Smart Campus - Email Verification",
            text: `Hello ${name},

Your IKGPTU Smart Campus verification OTP is:

${otp}

This OTP is valid for 10 minutes.

If you did not request this verification, you can ignore this email.

Regards,
IKGPTU Smart Campus`
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

        // 6. Create the verified student
        const student = await prisma.student.create({
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