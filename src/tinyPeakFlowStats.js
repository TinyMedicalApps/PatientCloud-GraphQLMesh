const moment = require("moment");
const fetch = require("node-fetch");

const flattenObservations = (observations) => {
  return observations.reduce((acc, obs) => {
    if (obs.component) {
      acc.concat(
        obs.component.map((comp) => {
          return { ...obs, ...comp };
        })
      );
    } else {
      acc.push(obs);
    }

    return acc;
  }, []);
};

const sumValueQuantity = (arr) => {
  return arr.reduce((sum, item) => {
    if (item.valueQuantity) {
      return sum + item.valueQuantity.value;
    } else {
      return sum;
    }
  }, 0);
};

const ObservationByPatientWithArgs = async (args) => {
  const { PatientID } = args;

  const res = await fetch(
    `https://api.logicahealth.org/PatientCloud401/open/Observation?${new URLSearchParams({
      patient: PatientID,
      _total: "accurate",
      _count: 1000,
      "code:code": "19935-6",
    })}`,
    {
      method: "GET",
      redirect: "follow",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  return await res.json();
};

const resolvers = {
  // enum define a restricted, pre-defined set of values
  // https://graphql.org/learn/schema/#enumeration-types
  PeriodInterval: {
    MONTH: "month",
    WEEK: "week",
  },
  OrderDirection: {
    ASC: "asc",
    DESC: "desc",
  },
  TinyPeakFlowResponse: {
    statsForPeriod: async (parent, args, context, info) => {
      // for each grouped observation, calculate avg
      const { order } = args;
      const { interval, limit = null } = parent.date_range;
      const incomingFormat = interval === "month" ? "MM_YYYY" : "WW_YYYY";
      const resultFormat = interval === "month" ? "DD-MM-YYYY" : "d-WW-YYYY";

      return (
        Object.entries(parent.grouped)
          .map(([key, obs]) => {
            return {
              AVGMeanValue: sumValueQuantity(obs) / obs.length,
              DateLabel: moment(key, incomingFormat).format(`${interval === "month" ? "MMMM YYYY" : "[Week] W YYYY"}`),
              DateNumber: moment(key, incomingFormat).format(resultFormat),
            };
          })
          // sort by given dateorder
          .sort((a, b) => {
            if (order === "desc") {
              return moment(b.DateNumber, resultFormat).diff(moment(a.DateNumber, resultFormat));
            } else {
              return moment(a.DateNumber, resultFormat).diff(moment(b.DateNumber, resultFormat));
            }
          })
      );
    },
    statsAllTime: async (parent, args, context, info) => {
      // for all observations, calculate avg and best value
      if (parent.all && parent.all.length) {
        const bestValue = Math.max(
          ...parent.all.map((e) => {
            return e.valueQuantity.value;
          })
        );

        return {
          BestValue: bestValue,
          EIGHTYPCBestValue: bestValue * 0.8,
          FIFTYPCBestValue: bestValue * 0.5,
          AVGMeanValue: sumValueQuantity(parent.all) / parent.all.length,
        };
      } else {
        return {};
      }
    },
  },
  Query: {
    TinyPeakFlowStats: async (parent, args, context, info) => {
      // date_range is set "month" as default
      const { PatientID, date_range } = args;

      const { interval, limit = null } = date_range;

      const res = await ObservationByPatientWithArgs({
        PatientID,
      });

      // const res = await context["LogicaHealth Sandbox v3"].api.ObservationByPatient({
      //   PatientID,
      // });

      // res is { entry: [...list of entries] }
      // for each entry, parse and return the full data object
      return Promise.all(
        res.entry.map(async (el) => {
          try {
            const singleEntry = await fetch(el.fullUrl, {
              method: "GET",
              redirect: "follow",
              headers: {
                "Content-Type": "application/json",
              },
            });

            return await singleEntry.json();
          } catch (error) {
            throw new Error(error);
          }
        })
      )
        .then((result) => {
          // flatten the observations array, because some might have multiple values on the same instance
          // then group by same month+year
          const filteredObservations = flattenObservations(result)
            // filter array if a limit is given
            .filter((elem) => {
              if (limit) {
                // check if current date is in the limit (so in the last <limit> <interval>)
                return moment(elem.effectiveDateTime).isAfter(moment().subtract(limit, interval));
              } else {
                return true;
              }
            });

          const groupBy = filteredObservations.reduce((accumulator, observation) => {
            const formattedDate = moment(observation.effectiveDateTime).format(
              interval === "month" ? "MM_YYYY`" : "WW_YYYY"
            );

            if (accumulator[formattedDate]) {
              accumulator[formattedDate].push(observation);
            } else {
              accumulator[formattedDate] = [observation];
            }

            return accumulator;
          }, {});
          // return grouped observations as well as the entire flattened list, so underlying resolvers can access these data

          return { grouped: groupBy, all: filteredObservations, date_range };
        })
        .catch((error) => {
          throw new Error(error);
        });
    },
  },
};

module.exports = { resolvers };
