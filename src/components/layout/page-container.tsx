import type { ReactNode } from "react";

type PageContainerProps = {
  children: ReactNode;
};

export function PageContainer({ children }: PageContainerProps) {
  return <div className="mx-auto w-full max-w-[1600px] px-4 py-5 md:px-6 lg:px-8">{children}</div>;
}