import { SiteFooter, SiteHeader } from "../parts/site-header";
import { ClassScreen } from "./class-screen";
export default function ClassesPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
        <h1 className="font-display text-4xl">Classes</h1>
        <ClassScreen />
      </main>
      <SiteFooter />
    </>
  );
}
