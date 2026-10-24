import "../../styles/tokens.css";
import { MotionLab } from "@/components/motion/lab/MotionLab";
import { fontVariables } from "@/lib/motion/typography";

export const metadata = {
  title: "Motion lab | Wayfinder",
  description: "Wayfinder motion and design system components with sample data.",
};

export default function MotionLabPage() {
  return (
    <div className={`lab-root ${fontVariables}`}>
      <MotionLab />
    </div>
  );
}
