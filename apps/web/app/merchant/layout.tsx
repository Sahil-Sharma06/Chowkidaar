import { Guard } from "@/components/Guard";

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <Guard role="merchant">{children}</Guard>;
}
