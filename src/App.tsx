import { Routes, Route } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import RecipeDetail from './RecipeDetail';
import AddRecipe from './components/AddRecipe';
import Toast from './components/Toast';
import { api } from './utils/api';
import { Recipe } from './types';

export default function App() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, set