import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, UserRound } from 'lucide-react';

import { guardarSesion } from '../../auth/sesion';
import { Button, FormError, Input, PasswordField } from '../../ui';
import { FOCO, unir } from '../../ui/clases';
import { iniciarSesion, registrarse } from './api';
import MarcoAuth, { EnlaceAuth, Encabezado } from './MarcoAuth';
import { conReintentos, mensajeDeLogin, validarContrasenaNueva } from './reglas';

const MODOS = [
    { clave: 'login', etiqueta: 'Iniciar sesión' },
    // Sólo los propietarios se registran: al inquilino lo da de alta su arrendador (ADR 0004).
    { clave: 'registro', etiqueta: 'Soy propietario' }
];

const Pestanas = ({ modo, onCambiar }) => (
    <div className="flex gap-1 p-1 mb-6 rounded-control bg-lavanda">
        {MODOS.map(({ clave, etiqueta }) => (
            <button
                key={clave}
                type="button"
                aria-pressed={modo === clave}
                onClick={() => onCambiar(clave)}
                className={unir(
                    'flex-1 h-9 m-0 px-3 font-sans text-sm font-medium border-0 rounded-chip cursor-pointer',
                    modo === clave ? 'bg-superficie text-indigo-medio' : 'bg-transparent text-texto-suave hover:text-texto',
                    FOCO
                )}
            >
                {etiqueta}
            </button>
        ))}
    </div>
);

function FormularioLogin() {
    const navigate = useNavigate();
    const [email, setEmail] = useState('');
    const [contrasena, setContrasena] = useState('');
    const [error, setError] = useState(null);
    const [despertando, setDespertando] = useState(false);
    const [enviando, setEnviando] = useState(false);

    const entrar = async (evento) => {
        evento.preventDefault();
        if (enviando) return;
        setError(null);
        setEnviando(true);
        try {
            const respuesta = await conReintentos(() => iniciarSesion({ email, contrasena }), {
                alReintentar: () => setDespertando(true)
            });
            // El token queda en memoria, no en localStorage: recargar la página
            // cierra la sesión, y es a propósito.
            guardarSesion({ token: respuesta.token, usuario: respuesta.usuario });
            // Con una contraseña temporal no hay otro sitio al que ir: la API
            // denegaría todo lo demás (ADR 0007).
            navigate(respuesta.usuario?.debe_cambiar_contrasena ? '/cambiar-contrasena' : '/', { replace: true });
        } catch (err) {
            setError(mensajeDeLogin(err));
        } finally {
            setDespertando(false);
            setEnviando(false);
        }
    };

    return (
        <>
            <Encabezado titulo="Bienvenido de nuevo">Ingresa tus credenciales para continuar.</Encabezado>

            <form onSubmit={entrar} className="flex flex-col gap-4">
                <FormError error={error} />
                {despertando && (
                    <p role="status" className="flex items-start gap-2 m-0 px-3 py-2.5 rounded-control bg-chip text-sm text-texto">
                        <Loader2 size={16} aria-hidden="true" className="shrink-0 mt-0.5 animate-spin" />
                        Estamos despertando el servicio: el primer acceso del día puede tardar hasta un minuto…
                    </p>
                )}
                <Input
                    etiqueta="Correo electrónico"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tu@correo.com"
                />
                <div>
                    <PasswordField
                        etiqueta="Contraseña"
                        autoComplete="current-password"
                        required
                        value={contrasena}
                        onChange={(e) => setContrasena(e.target.value)}
                    />
                    <div className="mt-2 text-right">
                        <EnlaceAuth to="/recuperar">¿Olvidaste tu contraseña?</EnlaceAuth>
                    </div>
                </div>
                <Button type="submit" cargando={enviando} className="w-full">Ingresar</Button>
            </form>

            <div className="flex items-start gap-3 mt-6 px-4 py-3 rounded-control bg-lavanda">
                <UserRound size={18} aria-hidden="true" className="shrink-0 mt-0.5 text-indigo-medio" />
                <div>
                    <p className="m-0 text-sm font-medium text-texto">¿Eres inquilino?</p>
                    <p className="m-0 text-xs text-texto-suave">Solicita tus credenciales a tu arrendador.</p>
                </div>
            </div>
        </>
    );
}

const REGISTRO_VACIO = { nombres: '', apellidos: '', documento: '', telefono: '', email: '', contrasena: '', confirmar: '' };

function FormularioRegistro({ alTerminar }) {
    const [datos, setDatos] = useState(REGISTRO_VACIO);
    const [error, setError] = useState(null);
    const [enviando, setEnviando] = useState(false);
    const [creada, setCreada] = useState(false);

    const campo = (nombre) => ({
        value: datos[nombre],
        onChange: (e) => setDatos((antes) => ({ ...antes, [nombre]: e.target.value }))
    });

    const registrar = async (evento) => {
        evento.preventDefault();
        const invalida = validarContrasenaNueva({ nueva: datos.contrasena, confirmar: datos.confirmar });
        if (invalida) {
            setError(invalida);
            return;
        }
        setError(null);
        setEnviando(true);
        try {
            // `confirmar` no viaja: `registrarse` recorta a los campos del contrato.
            await registrarse({ ...datos, email: datos.email.trim() });
            setCreada(true);
        } catch (err) {
            setError(err);
        } finally {
            setEnviando(false);
        }
    };

    if (creada) {
        return (
            <>
                <Encabezado titulo="¡Cuenta creada!">Ya puedes iniciar sesión con tu correo y contraseña.</Encabezado>
                <Button className="w-full" onClick={alTerminar}>Ir al inicio de sesión</Button>
            </>
        );
    }

    return (
        <>
            <Encabezado titulo="Crear cuenta">Regístrate como propietario para gestionar tus inmuebles.</Encabezado>

            <form onSubmit={registrar} className="flex flex-col gap-4">
                <FormError error={error} />
                <div className="flex flex-col sm:flex-row gap-4 [&>*]:flex-1">
                    <Input etiqueta="Nombres" autoComplete="given-name" required {...campo('nombres')} />
                    <Input etiqueta="Apellidos" autoComplete="family-name" required {...campo('apellidos')} />
                </div>
                <div className="flex flex-col sm:flex-row gap-4 [&>*]:flex-1">
                    <Input etiqueta="Documento" required {...campo('documento')} />
                    <Input etiqueta="Teléfono" type="tel" autoComplete="tel" {...campo('telefono')} />
                </div>
                <Input etiqueta="Correo electrónico" type="email" autoComplete="email" required {...campo('email')} />
                <div className="flex flex-col sm:flex-row gap-4 [&>*]:flex-1">
                    <PasswordField etiqueta="Contraseña" autoComplete="new-password" required ayuda="Mínimo 8 caracteres." {...campo('contrasena')} />
                    <PasswordField etiqueta="Confirmar" autoComplete="new-password" required {...campo('confirmar')} />
                </div>
                <Button type="submit" cargando={enviando} className="w-full">Crear cuenta</Button>
            </form>
        </>
    );
}

/** UI-01: inicio de sesión y autorregistro de propietarios. */
export default function Login() {
    const [modo, setModo] = useState('login');

    return (
        <MarcoAuth>
            <Pestanas modo={modo} onCambiar={setModo} />
            {modo === 'login' ? <FormularioLogin /> : <FormularioRegistro alTerminar={() => setModo('login')} />}
        </MarcoAuth>
    );
}
