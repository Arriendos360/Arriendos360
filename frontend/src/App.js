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
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/inmuebles" 
          element={
            <ProtectedRoute>
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