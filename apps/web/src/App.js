import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import CambiarContrasena from "./pages/CambiarContrasena";
import RecuperarContrasena from "./pages/RecuperarContrasena";
import RestablecerContrasena from "./pages/RestablecerContrasena";
import Inmuebles from "./pages/Inmuebles";
import Contratos from "./pages/Contratos";
import Pagos from "./pages/Pagos";
import "./App.css";

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