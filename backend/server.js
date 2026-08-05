require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { PrismaClient } = require("@prisma/client");
const app = express();
app.set("etag", false);
const prisma = new PrismaClient();
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