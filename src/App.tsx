import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import HomePage from "@/pages/HomePage";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/other" element={<div className="text-center text-xl">Other Page - Coming Soon</div>} />
      </Routes>
    </Router>
  );
}
