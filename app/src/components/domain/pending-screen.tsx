import { Link } from '@tanstack/react-router';
import { CenteredCardLayout } from '@/components/centered-card-layout';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { isSignedIn } from '@/lib/auth';
import { describeError } from '@/lib/error-message';

interface PendingScreenProps {
  /** What is happening while the link is followed: "Signing you in…". */
  title: string;
  /** What the screen says when the link did not work. */
  failedTitle: string;
  error: unknown;
  /** A sentence after the failure's own message, on what to do about it. */
  failedHint?: string;
}

/**
 * The page a link lands on while it does its work — signing in, accepting an invite — and what it says if that fails,
 * with the way back to sign in.
 */
export function PendingScreen({ title, failedTitle, error, failedHint }: PendingScreenProps) {
  if (error) {
    return (
      <CenteredCardLayout
        title={failedTitle}
        description={failedHint === undefined ? describeError(error) : `${describeError(error)} ${failedHint}`}
        footerActionsSlot={
          // A failed invite leaves its reader signed in, and /login would only bounce them on.
          isSignedIn() ? (
            <Button variant="outline" linkSlot={<Link to="/groups" />} content="Go to your groups" />
          ) : (
            <Button variant="outline" linkSlot={<Link to="/login" />} content="Back to sign in" />
          )
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
