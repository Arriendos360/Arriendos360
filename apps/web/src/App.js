import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Inmuebles from "./pages/Inmuebles";
import Contratos from "./pages/Contratos";
import Pagos from "./pages/Pagos";
import "./App.css";

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
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