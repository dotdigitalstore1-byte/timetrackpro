import type { Metadata } from "next";
import { BrandMark } from "@/components/Brand";

export const metadata: Metadata = {
  title: "Privacy Policy · Dotinout",
  description: "How Dotinout collects, uses, keeps and deletes employee and company information.",
};

/**
 * Public privacy policy. It is linked from the mobile sign-in screen, the web sign-in page and the store listings.
 * DRAFT: the wording must be reviewed by counsel before the store submission.
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-dvh bg-slate-50 px-5 py-10 text-slate-800 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <article className="mx-auto max-w-2xl">
        <header className="mb-8 flex items-center gap-3">
          <BrandMark className="h-9 w-9" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Dotinout</p>
            <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
          </div>
        </header>

        <p className="mb-6 text-sm text-slate-500">Last updated: November 2026</p>

        <section className="space-y-6 text-sm leading-relaxed">
          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">1. Who we are</h2>
            <p>
              Dotinout provides attendance, leave and salary tools for companies. Each company that uses Dotinout is
              the controller of its employees&apos; information. Dotinout processes that information on the company&apos;s
              behalf and for the company&apos;s own purposes.
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">2. What we collect</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Account details: full name, username or employee code, email address and phone number.</li>
              <li>Attendance: punch-in and punch-out times, and the work location where the punch was made.</li>
              <li>
                Photos: a live photo taken by the camera at each punch. Photos are taken only when you punch, never from
                your photo gallery.
              </li>
              <li>
                Location: the device&apos;s location is read only at the moment you punch, to check that you are at an
                approved work location. Dotinout does not track your location in the background.
              </li>
              <li>Leave requests, notices, agreements and salary records that your company enters or approves.</li>
              <li>Security signals on the device at punch time, such as whether location is simulated, used to protect attendance records.</li>
            </ul>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">3. How we use it</h2>
            <p>
              We use this information only to run the service: to sign you in, record attendance, process leave and
              salary, prevent false punches, and let your company and its managers see the records they are allowed to
              see. We do not sell personal information, and we do not use it for advertising or tracking across other
              apps and websites.
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">4. How long we keep it</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Punch photos are deleted automatically 45 days after the work date.</li>
              <li>Attendance and salary records are kept for the payroll periods your company needs for its records, after which they are removed.</li>
              <li>Account information is kept while the account is active and is removed when the account is deleted, subject to any legal duty to keep it.</li>
            </ul>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">5. Who we share it with</h2>
            <p>
              We share information only with service providers that help us run Dotinout, such as hosting, database,
              email delivery and payment providers, and only as far as they need it to do their job. Your company and the
              managers it authorises can see your attendance and related records.
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">6. Your choices and rights</h2>
            <p>
              You can ask your company admin to correct your details. You can change your password in the app&apos;s
              Profile screen. You may ask your company admin for a copy of your information or for your account to be
              deleted. Records your company must keep for payroll or by law may be retained as described in section 4.
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">7. Security</h2>
            <p>
              Information is sent over encrypted connections (HTTPS). Sign-in sessions are random, stored on the server
              and can be revoked. Access to records is limited by role.
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">8. Children</h2>
            <p>Dotinout is a workplace tool for employees and is not intended for children.</p>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">9. Changes to this policy</h2>
            <p>
              We will update this page when our practices change and show the new &quot;last updated&quot; date above.
            </p>
          </div>

          <div>
            <h2 className="mb-2 text-base font-bold text-slate-900">10. Contact us</h2>
            <p>
              For privacy questions, contact your company admin first. For anything else, use the support contact on
              dotinout.com.
            </p>
          </div>
        </section>
      </article>
    </main>
  );
}
