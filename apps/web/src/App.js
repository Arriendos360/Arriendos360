import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "./shell/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Login from "./features/auth/Login";
import CambiarContrasena from "./features/auth/CambiarContrasena";
import RecuperarContrasena from "./features/auth/RecuperarContrasena";
import RestablecerContrasena from "./features/auth/RestablecerContrasena";
import Inmuebles from "./pages/Inmuebles";
import Contratos from "./pages/Contratos";
import ContratoDetalle from "./pages/ContratoDetalle";
import Pagos from "./pages/Pagos";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Publicas por necesidad: quien las usa no puede entrar. */}
        <Route path="/recuperar" element={<RecuperarContrasena />} />
        <Route path="/restablecer" element={<RestablecerContrasena />} />
        {/* Unica ruta accesible con la contrasena temporal sin cambiar. Sin
            Layout: la barra lateral llevaria a sitios que la API deniega. */}
        <Route
          path="/cambiar-contrasena"
          element={
            <ProtectedRoute permitirCambioPendiente>
              <CambiarContrasena />
            </ProtectedRoute>
          }
        />
        {/* Dashboard e Inmuebles son solo de propietarios: el guardian corta la
            navegacion aunque la URL se escriba a mano. El backend lo vuelve a
            comprobar de todas formas (regla dura 8). */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute rolRequerido="PROPIETARIO">
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/inmuebles" 
          element={
            <ProtectedRoute rolRequerido="PROPIETARIO">
              <Layout>
                <Inmuebles />
              </Layout>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/contratos" 
          element={
            <ProtectedRoute>
              <Layout>
                <Contratos />
              </Layout>
            </ProtectedRoute>
          } 
        />
        {/* Detalle de un contrato con sus anexos. Accesible a los dos roles:
            el inquilino se descarga lo que hay firmado, el propietario ademas
            adjunta. El backend lo vuelve a comprobar (regla dura 8). */}
        <Route
          path="/contratos/:id"
          element={
            <ProtectedRoute>
              <Layout>
                <ContratoDetalle />
              </Layout>
            </ProtectedRoute>
          }
        />
        <Route 
          path="/pagos" 
          element={
            <ProtectedRoute>
              <Layout>
                <Pagos />
              </Layout>
            </ProtectedRoute>
          } 
        />
      </Routes>
    </Router>
  );
}

export default App;