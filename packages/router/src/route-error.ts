export class RouteError {
  readonly __ilhaRouteError = true as const;
  readonly status: number;
  readonly message: string;
  constructor(status: number, message: string) {
    this.message = message;
    this.status = status >= 400 && status <= 599 ? status : 500;
  }
}
