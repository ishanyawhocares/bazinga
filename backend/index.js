// index.js - Final Production-Ready Code

// Import necessary packages
const express = require('express');
const Razorpay = require('razorpay');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const cors = require('cors');
const path = require('path'); // Import path module
require('dotenv').config();

const app = express();

// --- Middlewares ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors()); // In production, you might want to restrict this to your frontend's domain

// --- Serve Frontend Statically (DISABLED for Render deployment) ---
// ❌ On Render, we don’t serve the frontend here — it’s hosted separately on Vercel
// const frontendPath = path.join(__dirname, '..', 'Frontend');
// app.use(express.static(frontendPath));

// --- RAZORPAY INSTANCE ---
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// --- NODEMAILER TRANSPORTER ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

// --- IN-MEMORY STORAGE FOR OTP ---
// WARNING: This is not ideal for production. Data will be lost on server restart.
// For a more robust solution, consider using Redis or a simple database.
const otpStorage = new Map();

// --- UTILITY FUNCTIONS ---
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function isOTPExpired(timestamp) {
    return Date.now() - timestamp > 5 * 60 * 1000; // 5 minutes
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- API ENDPOINTS ---

/**
 * @route   GET /api/config
 * @desc    Provide public keys and config to the frontend securely
 * @access  Public
 */
app.get('/api/config', (req, res) => {
    res.json({
        razorpayKeyId: process.env.RAZORPAY_KEY_ID
    });
});


/**
 * @route   POST /api/send-otp
 * @desc    Send OTP to email for verification
 */
app.post('/api/send-otp', async (req, res) => {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Valid email is required' });
    }
    try {
        const otp = generateOTP();
        otpStorage.set(email, { otp, timestamp: Date.now(), verified: false });
        const mailOptions = {
            from: `"BAZINGA! Verification" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: '🔐 Your BAZINGA! Verification Code',
            html: `
                <div style="font-family: Arial, sans-serif; text-align: center; color: #333;">
                    <h2>BAZINGA! Verification</h2>
                    <p>Your verification code is:</p>
                    <p style="font-size: 24px; font-weight: bold; letter-spacing: 4px;">${otp}</p>
                    <p>This code expires in 5 minutes.</p>
                </div>
            `,
        };
        await transporter.sendMail(mailOptions);
        console.log(`OTP sent to: ${email} (OTP: ${otp})`);
        res.json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Error sending OTP:', error);
        res.status(500).json({ error: 'Failed to send OTP' });
    }
});

/**
 * @route   POST /api/verify-otp
 * @desc    Verify OTP and mark email as verified
 */
app.post('/api/verify-otp', (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) {
        return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const otpData = otpStorage.get(email);
    if (!otpData) {
        return res.status(400).json({ error: 'Please request an OTP first.' });
    }
    if (isOTPExpired(otpData.timestamp)) {
        otpStorage.delete(email);
        return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }
    if (otpData.otp !== otp.toString()) {
        return res.status(400).json({ error: 'Invalid OTP.' });
    }

    otpStorage.set(email, { ...otpData, verified: true });
    console.log(`Email verified: ${email}`);
    res.json({ success: true, message: 'Email verified successfully' });
});

/**
 * @route   POST /api/create-order
 * @desc    Creates a Razorpay order for verified emails
 */
app.post('/api/create-order', async (req, res) => {
    const { email } = req.body;
    const otpData = otpStorage.get(email);
    if (!otpData || !otpData.verified) {
        return res.status(403).json({ error: 'Email not verified.' });
    }

    const options = {
        amount: 150, // ₹1.50
        currency: 'INR',
        receipt: `receipt_order_${crypto.randomBytes(4).toString('hex')}`,
        notes: { user_email: email },
    };

    try {
        const order = await razorpay.orders.create(options);
        res.json(order);
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        res.status(500).json({ error: 'Failed to create order' });
    }
});

/**
 * @route   POST /api/verify-payment
 * @desc    Verifies payment and sends email with JPGs
 */
app.post('/api/verify-payment', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, email } = req.body;

    const body = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

    if (expectedSignature !== razorpay_signature) {
        return res.status(400).json({ status: 'error', message: 'Invalid payment signature.' });
    }

    console.log(`Payment verified for: ${email}`);

    // --- MODIFICATION FOR 11 JPGs ---
    // Create an array of attachments.
    // Ensure you have files named bazinga_01.jpg, bazinga_02.jpg, etc., in the 'files' folder.
    const attachments = [];
    for (let i = 1; i <= 11; i++) {
        const number = i.toString().padStart(2, '0'); // Formats to 01, 02, ... 11
        attachments.push({
            filename: `bazinga_${number}.jpg`,
            path: path.join(__dirname, 'files', `bazinga_${number}.jpg`),
        });
    }

    const mailOptions = {
        from: `"BAZINGA!" <${process.env.EMAIL_USER}>`,
        to: email,
        subject: 'Here is your Big Bang Theory Image Collection! 🚀',
        html: `
            <div style="font-family: Arial, sans-serif; text-align: center; color: #333;">
                <h2>BAZINGA! Payment Successful! 🎉</h2>
                <p>Hey there, fellow genius!</p>
                <p>Thank you for your purchase. We've attached your exclusive 
                <strong>Big Bang Theory Image Collection</strong> to this email.</p>
                <p>Get ready to explore the cosmos of comedy and science!</p>
                <br>
                <p>Best regards,</p>
                <p><strong>The BAZINGA Team 🧬</strong></p>
            </div>
        `,
        attachments: attachments, // Use the generated attachments array
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`Image collection sent to: ${email}`);
        otpStorage.delete(email); // Clean up OTP data
        res.json({ status: 'success', message: 'Payment successful and images sent!' });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ status: 'error', message: 'Payment verified, but email failed.' });
    }
});

// --- Fallback for all other GET requests ---
// ❌ Disabled because frontend is hosted on Vercel, not from this server
// app.get('*', (req, res) => {
//     res.sendFile(path.join(frontendPath, 'index.html'));
// });

// --- START THE SERVER ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🎉 BAZINGA backend server is running on port ${PORT}`);
});
