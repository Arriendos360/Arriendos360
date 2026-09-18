import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';

import { Button, Input } from '../../ui';
import { solicitarRecuperacion } from './api';
import MarcoAuth, { EnlaceAuth, Encabezado } from './MarcoAuth';

/**
 * Solicitud de recuperación.
 *
 * La pantalla NO dice si el correo existe: muestra el mismo mensaje siempre,
 * porque el backend responde lo mismo siempre. Si la interfaz distinguiera,
 * daría el dato que la API se cuida de no dar. Ver docs/adr/0010.
 */
export default function RecuperarContrasena() {
    const [email, setEmail] = useState('');
    const [enviado, setEnviado] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const enviar = async (evento) => {
        evento.preventDefault();
        setEnviando(true);
        try {
            await solicitarRecuperacion({ email });
        } catch {
            // Tampoco un fallo de red cambia lo que se muestra: si el mensaje
            // dependiera de la respuesta, volvería a ser un oráculo.
        } finally {
            setEnviado(true);
            setEnviando(false);
        }
    };

    return (
        <MarcoAuth>
            {enviado ? (
                <>
                    <Encabezado titulo="Revisa tu correo">
                        Si <span className="font-medium text-texto">{email.trim()}</span> corresponde a una cuenta, te
                        llegará un enlace para elegir una contraseña nueva. Vale una sola vez y caduca en 30 minutos.
                    </Encabezado>
                    <p className="m-0 mb-6 text-xs text-texto-suave">Revisa también la carpeta de correo no deseado.</p>
                </>
            ) : (
                <>
                    <Encabezado titulo="Recuperar contraseña">
                        Escribe tu correo y te enviaremos un enlace para elegir una contraseña nueva.
                    </Encabezado>
                    <form onSubmit={enviar} className="flex flex-col gap-4 mb-6">
                        <Input
                            etiqueta="Correo electrónico"
                            type="email"
                            autoComplete="email"
                            required
                            autoFocus
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="tu@correo.com"
                        />
                        <Button type="submit" cargando={enviando} className="w-full">Enviar enlace</Button>
                    </form>
                </>
            )}
            <EnlaceAuth to="/login" className="inline-flex items-center gap-1.5 self-center">
                <ArrowLeft size={14} aria-hidden="true" /> Volver al inicio de sesión
            </EnlaceAuth>
        </MarcoAuth>
    );
}
