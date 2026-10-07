import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#fdf5e6] text-stone-800">
      <h1 className="text-2xl font-bold text-[#6b4e3a]">宋代缂丝织造工坊</h1>
      <Link
        to="/scheduling"
        className="rounded-md border border-[#8b6f47] bg-[#8b6f47] px-5 py-2 text-sm font-medium text-[#fdf5e6] transition hover:scale-105"
      >
        进入织造排产与工时推演
      </Link>
    </div>
  );
}
