import { Link } from "@tanstack/react-router";
import { CenteredCardLayout } from "@/components/centered-card-layout";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { describeError } from "@/lib/error-message";

interface PendingScreenProps {
  /** What is happening while the link is followed: "Signing you in…". */
  title: string;
  /** What the screen says when the link did not work. */
  failedTitle: string;
  error: unknown;
}

/**
 * The page a link from an email lands on while it does its work — signing in, accepting an
 * invite — and what it says if that fails, with the way back to sign in.
 */
export function PendingScreen({ title, failedTitle, error }: PendingScreenProps) {
  if (error) {
    return (
      <CenteredCardLayout
        title={failedTitle}
        description={describeError(error)}
        footerActionsSlot={
          <Button variant="outline" linkSlot={<Link to="/login" />} content="Back to sign in" />
        }
      />
    );
  }

  return (
    <CenteredCardLayout
      title={title}
      contentSlot={
        <div className="flex justify-center">
          <Spinner label={title} />
        </div>
      }
    />
  );
}
