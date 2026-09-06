const nodemailer = require('nodemailer');
require('dotenv').config();

// Configuración de transporte (Simulado si no hay credenciales reales)
const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.ethereal.email',
    port: process.env.EMAIL_PORT || 587,
    auth: {
        user: process.env.EMAIL_USER || 'test@example.com',
        pass: process.env.EMAIL_PASS || 'password'
    }
});

const enviarCorreo = async (to, subject, html) => {
    if (process.env.NODE_ENV === 'test') {
        console.log(`🧪 [TEST MODE] Simulación de correo a ${to}: ${subject}`);
        return { messageId: 'test-id' };
    }

    try {
        const info = await transporter.sendMail({
            from: '"Arriendos360 🏠" <noreply@arriendos360.com>',
            to,
            subject,
            html
        });
        console.log(`📧 Correo enviado a ${to}: ${subject}`);
        // Si usas Ethereal, puedes ver la URL de prueba
        if (process.env.NODE_ENV !== 'production') {
            console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
        }
        return info;
    } catch (error) {
        console.error('❌ Error enviando correo:', error);
    }
};

module.exports = { enviarCorreo };
