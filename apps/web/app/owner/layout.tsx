import { Guard } from "@/components/Guard";

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  return <Guard role="owner">{children}</Guard>;
}
