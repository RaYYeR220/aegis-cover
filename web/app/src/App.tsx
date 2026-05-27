import { Routes, Route } from "react-router-dom";
import { Nav } from "./components/Nav";
import { Dashboard } from "./pages/Dashboard";
import { Guardian } from "./pages/Guardian";
import { Policies } from "./pages/Policies";
import { Underwrite } from "./pages/Underwrite";
import { Activity } from "./pages/Activity";

export default function App() {
  return (
    <div id="app">
      <Nav />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/guardian" element={<Guardian />} />
        <Route path="/policies" element={<Policies />} />
        <Route path="/underwrite" element={<Underwrite />} />
        <Route path="/activity" element={<Activity />} />
      </Routes>
    </div>
  );
}
