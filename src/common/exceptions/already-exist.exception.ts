import { HttpException, HttpStatus } from '@nestjs/common';

export class AlreadyExistException extends HttpException {
  constructor(entityName: string = 'Resource', message?: string) {
    const defaultMessage = `${entityName} already exists`;
    super(message || defaultMessage, HttpStatus.CONFLICT);
  }
}
