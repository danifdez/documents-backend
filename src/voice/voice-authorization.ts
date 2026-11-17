import type { Socket } from 'socket.io';
import type { AuthService } from '../auth/auth.service';
import { Permission } from '../auth/permission.enum';
import { authorizeInferenceCapture } from '../execution/inference-capture';

/** Both client controls and worker evidence require the current authority. */
export async function authorizeVoiceConnection(
  auth: AuthService,
  client: Socket,
) {
  const consent = client.handshake.headers['x-evaluation-consent'];
  if (!auth.isAuthEnabled())
    return {
      principal: 'standalone',
      captureInput: authorizeInferenceCapture(undefined, consent as string),
    };
  const token =
    client.handshake.auth?.token ??
    client.handshake.headers.authorization?.replace(/^Bearer /, '');
  const { user, expiresAt } = await auth.authenticateAccessToken(token);
  if (user.permissions?.[Permission.ASK] !== true)
    throw new Error('Voice authorization required');
  return {
    principal: String(user.id),
    expiresAt,
    captureInput: authorizeInferenceCapture(
      { userId: user.id, permissions: user.permissions },
      consent as string,
    ),
  };
}
